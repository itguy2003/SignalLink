// 기관게시판·수집 데이터 — FastAPI /api/v1/boards 의 짝(전체 이식).
//
// 게시판 위젯(공지사항/가정통신문 등)이 표출할 데이터의 수집원을 등록하고,
// 수집 결과를 조회·직접 입력한다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record OrgBoardOut(
    int Id, int OrgId, string Name, string Kind, string Url, string? ScrapeMethod,
    string? ScrapeResult, int ScrapeCount, DateTime? LastScrapedAt);

public record OrgBoardCreateIn(int OrgId, string Name, string Kind, string Url, string? ScrapeMethod);

public class OrgBoardUpdateIn
{
    public string? Name { get; set; }
    public string? Kind { get; set; }
    public string? Url { get; set; }
    public string? ScrapeMethod { get; set; }
}

public record BoardPostOut(
    int Id, int BoardId, string Title, string? Author, DateOnly? PostedOn,
    int? Year, int? Month, int? Day, int? Term, string? Content);

public record BoardPostCreateIn(
    string Title, string? Author, DateOnly? PostedOn, int? Term, string? Content);

[ApiController]
[Route("api/v1/boards")]
[Authorize]
public class BoardsController(AppDbContext db, PermissionService permissions) : ControllerBase
{
    private static OrgBoardOut ToOut(OrgBoard board) => new(
        board.Id, board.OrgId, board.Name, board.Kind, board.Url, board.ScrapeMethod,
        board.ScrapeResult, board.ScrapeCount, board.LastScrapedAt);

    private static BoardPostOut ToPostOut(BoardPost post) => new(
        post.Id, post.BoardId, post.Title, post.Author, post.PostedOn,
        post.Year, post.Month, post.Day, post.Term, post.Content);

    [HttpGet("")]
    public async Task<ActionResult<List<OrgBoardOut>>> List([FromQuery(Name = "org_id")] int? orgId)
    {
        var actor = HttpContext.CurrentUser()!;
        var targetOrg = orgId ?? actor.OrgId;
        if (!await permissions.CanViewOrgAsync(actor, targetOrg))
            return StatusCode(403, new { detail = "해당 기관의 게시판을 조회할 권한이 없습니다." });
        var boards = await db.OrgBoards.Where(b => b.OrgId == targetOrg)
            .OrderBy(b => b.Id).ToListAsync();
        return boards.Select(ToOut).ToList();
    }

    [HttpPost("")]
    public async Task<ActionResult<OrgBoardOut>> Create(OrgBoardCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        if (!await permissions.CanManageOrgAsync(actor, payload.OrgId))
            return StatusCode(403, new { detail = "해당 기관에 게시판을 등록할 권한이 없습니다." });
        if (await db.Organizations.FindAsync(payload.OrgId) is null)
            return BadRequest(new { detail = "존재하지 않는 기관입니다." });

        var now = DateTime.UtcNow;
        var board = new OrgBoard
        {
            OrgId = payload.OrgId,
            Name = payload.Name ?? "",
            Kind = payload.Kind,
            Url = payload.Url,
            ScrapeMethod = payload.ScrapeMethod,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.OrgBoards.Add(board);
        await db.SaveChangesAsync();
        return StatusCode(201, ToOut(board));
    }

    [HttpPut("{boardId:int}")]
    public async Task<ActionResult<OrgBoardOut>> Update(int boardId, OrgBoardUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var board = await db.OrgBoards.FindAsync(boardId);
        if (board is null) return NotFound(new { detail = "게시판을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, board.OrgId))
            return StatusCode(403, new { detail = "해당 게시판을 수정할 권한이 없습니다." });

        if (payload.Name is not null) board.Name = payload.Name;
        if (payload.Kind is not null) board.Kind = payload.Kind;
        if (payload.Url is not null) board.Url = payload.Url;
        if (payload.ScrapeMethod is not null) board.ScrapeMethod = payload.ScrapeMethod;
        board.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return ToOut(board);
    }

    [HttpDelete("{boardId:int}")]
    public async Task<ActionResult<Message>> Delete(int boardId)
    {
        var actor = HttpContext.CurrentUser()!;
        var board = await db.OrgBoards.FindAsync(boardId);
        if (board is null) return NotFound(new { detail = "게시판을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, board.OrgId))
            return StatusCode(403, new { detail = "해당 게시판을 삭제할 권한이 없습니다." });
        db.OrgBoards.Remove(board);
        await db.SaveChangesAsync();
        return new Message("게시판이 삭제되었습니다.");
    }

    [HttpGet("{boardId:int}/posts")]
    public async Task<ActionResult<PageOut<BoardPostOut>>> ListPosts(
        int boardId, [FromQuery] int? year, [FromQuery] int? month,
        [FromQuery] int page = 1, [FromQuery] int size = 20)
    {
        var actor = HttpContext.CurrentUser()!;
        var board = await db.OrgBoards.FindAsync(boardId);
        if (board is null) return NotFound(new { detail = "게시판을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, board.OrgId))
            return StatusCode(403, new { detail = "해당 게시판을 조회할 권한이 없습니다." });

        var query = db.BoardPosts.Where(p => p.BoardId == boardId);
        if (year is not null) query = query.Where(p => p.Year == year);
        if (month is not null) query = query.Where(p => p.Month == month);

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(p => p.Id)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        return new PageOut<BoardPostOut>(rows.Select(ToPostOut).ToList(), total, page, size);
    }

    /// <summary>스크래핑이 어려운 게시판은 관리자가 직접 입력한다.</summary>
    [HttpPost("{boardId:int}/posts")]
    public async Task<ActionResult<BoardPostOut>> CreatePost(int boardId, BoardPostCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var board = await db.OrgBoards.FindAsync(boardId);
        if (board is null) return NotFound(new { detail = "게시판을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, board.OrgId))
            return StatusCode(403, new { detail = "해당 게시판에 데이터를 입력할 권한이 없습니다." });

        var post = new BoardPost
        {
            BoardId = boardId,
            Title = payload.Title,
            Author = payload.Author,
            PostedOn = payload.PostedOn,
            Term = payload.Term,
            Content = payload.Content,
            // 년/월/일로 분해해 둔다 — 위젯 필터링용(요구사항 #게시판 스크래핑).
            Year = payload.PostedOn?.Year,
            Month = payload.PostedOn?.Month,
            Day = payload.PostedOn?.Day,
        };
        db.BoardPosts.Add(post);
        board.ScrapeCount = await db.BoardPosts.CountAsync(p => p.BoardId == boardId) + 1;
        await db.SaveChangesAsync();
        return StatusCode(201, ToPostOut(post));
    }

    [HttpDelete("{boardId:int}/posts/{postId:int}")]
    public async Task<ActionResult<Message>> DeletePost(int boardId, int postId)
    {
        var actor = HttpContext.CurrentUser()!;
        var post = await db.BoardPosts.FindAsync(postId);
        if (post is null || post.BoardId != boardId)
            return NotFound(new { detail = "게시글을(를) 찾을 수 없습니다." });
        var board = await db.OrgBoards.FindAsync(boardId);
        if (board is null || !await permissions.CanManageOrgAsync(actor, board.OrgId))
            return StatusCode(403, new { detail = "해당 게시글을 삭제할 권한이 없습니다." });
        db.BoardPosts.Remove(post);
        await db.SaveChangesAsync();
        return new Message("삭제되었습니다.");
    }
}
