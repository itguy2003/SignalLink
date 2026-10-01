// 장치 제어 채널 암호화 검증.
//
// 봉투 형식 base64( VERSION(1) || nonce(12) || ct || tag(16) ), AAD=장치
// 고유번호 — 이 계약은 FastAPI 와 모든 플레이어 스택(JS/.NET/Flutter)이
// 공유한다. 형식이 조금이라도 바뀌면 장치가 봉투를 못 연다.

using System.Text.Json.Nodes;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class DeviceCryptoTests
{
    private static DeviceCrypto Crypto(string masterKey = "test-master-key") =>
        new(TestConfig.Of(("DeviceMasterKey", masterKey)));

    private const string Code = "ABCD-234-EFG";

    [Fact]
    public void 암호화한_봉투를_같은_장치_키로_연다()
    {
        var crypto = Crypto();
        var token = crypto.EncryptForDevice(Code, new { hello = "세계", n = 5 });
        var opened = crypto.DecryptFromDevice(Code, token);

        Assert.Equal("세계", opened["hello"]!.GetValue<string>());
        Assert.Equal(5, opened["n"]!.GetValue<int>());
    }

    [Fact]
    public void 봉투_형식이_계약대로다()
    {
        var raw = Convert.FromBase64String(Crypto().EncryptForDevice(Code, new { a = 1 }));
        Assert.Equal(1, raw[0]);                       // VERSION
        // {"a":1} = 7바이트 평문 → 1 + 12(nonce) + 7 + 16(tag)
        Assert.Equal(1 + 12 + 7 + 16, raw.Length);
    }

    [Fact]
    public void 다른_장치_고유번호로는_열리지_않는다()
    {
        // 키 유도(salt)와 AAD 둘 다 장치 고유번호다 — 봉투를 가로채도
        // 다른 장치에서는 쓸모가 없다.
        var crypto = Crypto();
        var token = crypto.EncryptForDevice(Code, new { a = 1 });
        Assert.Throws<DecryptException>(() => crypto.DecryptFromDevice("ZZZZ-999-999", token));
    }

    [Fact]
    public void 변조된_봉투는_거부한다()
    {
        var crypto = Crypto();
        var raw = Convert.FromBase64String(crypto.EncryptForDevice(Code, new { a = 1 }));
        raw[^1] ^= 0xFF;  // 태그 한 바이트를 뒤집는다.
        Assert.Throws<DecryptException>(
            () => crypto.DecryptFromDevice(Code, Convert.ToBase64String(raw)));
    }

    [Fact]
    public void 마스터_키가_다르면_열리지_않는다()
    {
        var token = Crypto("master-a").EncryptForDevice(Code, new { a = 1 });
        Assert.Throws<DecryptException>(() => Crypto("master-b").DecryptFromDevice(Code, token));
    }

    [Theory]
    [InlineData("not-base64!!")]
    [InlineData("AAAA")]  // 너무 짧은 봉투
    public void 깨진_봉투는_형식_오류로_거부한다(string token)
    {
        Assert.Throws<DecryptException>(() => Crypto().DecryptFromDevice(Code, token));
    }

    [Fact]
    public void 장치마다_유도_키가_다르다()
    {
        var crypto = Crypto();
        Assert.NotEqual(crypto.DeriveDeviceKey("AAAA-AAA-AAA"), crypto.DeriveDeviceKey("BBBB-BBB-BBB"));
        Assert.Equal(32, crypto.DeriveDeviceKey(Code).Length);
    }
}
