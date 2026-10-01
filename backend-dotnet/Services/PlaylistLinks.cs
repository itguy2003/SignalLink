// 콘텐츠 문서 ↔ 재생목록 색인 — FastAPI(app/services/playlists.py)의 짝.
//
// 이 색인이 없으면 재생목록을 고쳤을 때 어느 스케줄의 버전을 올려야 하는지
// 알 수 없고, 장치는 바뀐 재생목록을 영영 받지 못한다.

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public class PlaylistLinkService(AppDbContext db)
{
    /// <summary>문서가 참조하는 재생목록 id — 형식이 어긋난 요소는 조용히 건너뛴다.</summary>
    public static HashSet<int> ReferencedIds(JsonNode? document)
    {
        var found = new HashSet<int>();
        if (document?["elements"] is not JsonArray elements) return found;
        foreach (var element in elements)
        {
            if (element is not JsonObject obj) continue;
            if (obj["type"]?.GetValue<string?>() != "playlist") continue;
            var id = obj["options"]?["playlist_id"];
            if (id is JsonValue value && value.TryGetValue<int>(out var playlistId))
                found.Add(playlistId);
        }
        return found;
    }

    /// <summary>콘텐츠의 재생목록 색인을 문서와 맞춘다. 저장은 호출자가 한다.</summary>
    public async Task SyncLinksAsync(Content content)
    {
        var wanted = ReferencedIds(Json.Parse(content.DocumentJson));
        if (wanted.Count > 0)
        {
            // 존재하지 않는 재생목록은 색인하지 않는다 — FK 위반으로 저장이 실패한다.
            var alive = await db.Playlists.Where(p => wanted.Contains(p.Id))
                .Select(p => p.Id).ToListAsync();
            wanted.IntersectWith(alive);
        }

        var current = content.PlaylistLinks.Select(l => l.PlaylistId).ToHashSet();
        foreach (var link in content.PlaylistLinks.Where(l => !wanted.Contains(l.PlaylistId)).ToList())
        {
            content.PlaylistLinks.Remove(link);
            db.ContentPlaylists.Remove(link);
        }
        foreach (var playlistId in wanted.Where(id => !current.Contains(id)))
            content.PlaylistLinks.Add(new ContentPlaylist { PlaylistId = playlistId });
    }
}
