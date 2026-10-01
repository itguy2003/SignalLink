// 스케줄 합성 버전 산식 검증.
//
// 하트비트는 이 숫자 하나로 "장치가 다시 받아야 하는가"를 판단한다. 산식은
// FastAPI 와 모든 플레이어가 공유하는 계약이라 값 자체를 상수로 못박는다 —
// 산식이 바뀌면 모든 장치가 일제히 재수신하거나, 반대로 변경을 놓친다.

using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class ScheduleCoreTests
{
    private static Device DeviceWith(params Schedule[] schedules)
    {
        var device = new Device { Id = 1, DeviceCode = "AAAA-AAA-AAA" };
        foreach (var schedule in schedules)
            device.ScheduleLinks.Add(new DeviceScheduleLink { Schedule = schedule });
        return device;
    }

    [Fact]
    public void 배정이_없으면_데모_버전_0이다()
    {
        Assert.Equal(0, ScheduleCoreService.CurrentVersion(DeviceWith()));
    }

    [Fact]
    public void 산식은_파이썬과_같은_상수를_낸다()
    {
        // digest = id*131 + version*7 + active(1) = 5*131 + 3*7 + 1 = 677
        var device = DeviceWith(new Schedule { Id = 5, Version = 3 });
        Assert.Equal(677, ScheduleCoreService.CurrentVersion(device));
    }

    [Fact]
    public void 여러_배정은_id_순서로_접는다()
    {
        // (2,1,활성) → 270; 270*1_000_003 + 9*131 + 4*7 + 0 = 270_002_017
        var past = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var device = DeviceWith(
            new Schedule { Id = 9, Version = 4, EndAt = past },   // 기간 밖 → active 0
            new Schedule { Id = 2, Version = 1 });
        Assert.Equal(270_002_017, ScheduleCoreService.CurrentVersion(device));
    }

    [Fact]
    public void 버전이_오르면_합성_버전도_변한다()
    {
        var before = ScheduleCoreService.CurrentVersion(DeviceWith(new Schedule { Id = 5, Version = 3 }));
        var after = ScheduleCoreService.CurrentVersion(DeviceWith(new Schedule { Id = 5, Version = 4 }));
        Assert.NotEqual(before, after);
    }

    [Fact]
    public void 기간이_지나기만_해도_합성_버전이_변한다()
    {
        // 시각이 흘러 스케줄이 기간 밖이 되면 장치가 알아채야 한다 — 그래서
        // active 여부가 산식에 들어간다.
        var schedule = new Schedule
        {
            Id = 5,
            Version = 3,
            EndAt = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
        };
        var during = ScheduleCoreService.CurrentVersion(DeviceWith(schedule), new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc));
        var after = ScheduleCoreService.CurrentVersion(DeviceWith(schedule), new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.NotEqual(during, after);
    }

    [Fact]
    public void SQLite_가_주는_naive_시각은_UTC_로_읽는다()
    {
        var naive = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Unspecified);
        Assert.Equal(DateTimeKind.Utc, ScheduleCoreService.AsUtc(naive)!.Value.Kind);
    }
}

public class OrientationTests
{
    [Theory]
    [InlineData(1920, 1080, "LANDSCAPE")]
    [InlineData(1080, 1920, "PORTRAIT")]
    [InlineData(100, 100, "LANDSCAPE")]  // 정사각형은 가로 취급
    public void 크기로_방향을_정한다(double width, double height, string expected)
    {
        // 값은 PanelType 열거형과 같아야 한다 — 스케줄 orientation 과 직접 비교된다.
        Assert.Equal(expected, Orientation.OfSize(width, height));
    }

    [Theory]
    [InlineData("LANDSCAPE", "가로형")]
    [InlineData("PORTRAIT", "세로형")]
    public void 오류_문구에는_한국어_이름을_쓴다(string value, string expected)
    {
        Assert.Equal(expected, Orientation.Label(value));
    }
}

public class NoticePeriodTests
{
    private static OrgNotice Notice(string? start, string? end) =>
        new() { StartDate = start, EndDate = end };

    private static DateTime At(string text) =>
        DateTime.ParseExact(text, "yyyy-MM-ddTHH:mm", null);

    [Fact]
    public void 기간이_없으면_늘_유효하다()
    {
        Assert.True(ScheduleCoreService.NoticeActiveOn(Notice(null, null), At("2026-09-18T10:00")));
    }

    [Theory]
    [InlineData("2026-09-18T08:59", false)]  // 시작 전
    [InlineData("2026-09-18T09:00", true)]   // 시작 경계 포함
    [InlineData("2026-09-18T15:00", true)]   // 종료 경계 포함
    [InlineData("2026-09-18T15:01", false)]  // 종료 후
    public void 분_단위로_판정한다(string now, bool expected)
    {
        var notice = Notice("2026-09-18T09:00", "2026-09-18T15:00");
        Assert.Equal(expected, ScheduleCoreService.NoticeActiveOn(notice, At(now)));
    }

    [Fact]
    public void 날짜만_저장된_옛_값은_종료일_하루가_통째로_유효하다()
    {
        var notice = Notice("2026-09-01", "2026-09-18");
        Assert.True(ScheduleCoreService.NoticeActiveOn(notice, At("2026-09-18T23:30")));
        Assert.False(ScheduleCoreService.NoticeActiveOn(notice, At("2026-09-19T00:00")));
        Assert.True(ScheduleCoreService.NoticeActiveOn(notice, At("2026-09-01T00:00")));
    }
}

public class DeviceSupportTests
{
    [Fact]
    public void 고유번호는_XXXX_XXX_XXX_형식이다()
    {
        Assert.Equal("ABCD-234-EFG", DeviceCode.FormatCode("ABCD234EFG"));
        Assert.Throws<ArgumentException>(() => DeviceCode.FormatCode("SHORT"));
    }

    [Fact]
    public void 원문은_혼동_글자를_뺀_10자리다()
    {
        for (var round = 0; round < 20; round++)
        {
            var raw = DeviceCode.GenerateRaw();
            Assert.Equal(10, raw.Length);
            // I, O, 0, 1 은 설치 기사가 손으로 옮겨 적을 때 헷갈린다.
            Assert.All(raw, ch => Assert.DoesNotContain(ch, "IO01"));
            Assert.Matches("^[A-Z2-9]{10}$", raw);
        }
    }

    [Theory]
    [InlineData(100L, 20L, 0.8)]
    [InlineData(100L, 100L, 0.0)]
    [InlineData(null, 20L, null)]
    [InlineData(0L, 0L, null)]  // 0 으로 나누기 방지
    public void 저장소_사용률을_계산한다(long? total, long? free, double? expected)
    {
        Assert.Equal(expected, DeviceStorage.UsageRatio(total, free));
    }
}
