// 장치↔서버 제어 채널 암호화 — FastAPI(app/core/crypto.py)의 짝.
//
// 모든 클라이언트 스택에서 표준 라이브러리만으로 구현 가능한 프리미티브:
//   키 유도: HKDF-SHA256(master_key, salt=device_code, info=INFO) -> 32 byte
//   암호화 : AES-256-GCM (nonce 12B, tag 16B), AAD = device_code
//   전송   : base64( VERSION(1) || nonce(12) || ciphertext || tag(16) )
//
// FastAPI 와 같은 마스터 키(.env 의 DEVICE_MASTER_KEY)를 쓰므로 두 서버가
// 같은 장치와 같은 봉투를 주고받는다.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Services;

public class DecryptException(string message) : Exception(message);

public class DeviceCrypto(IConfiguration config)
{
    private const byte EnvelopeVersion = 1;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private static readonly byte[] KdfInfo = "signallink-device-channel-v1"u8.ToArray();

    private string MasterKey => config["DeviceMasterKey"] ?? "dev-device-master-key-change-me";

    /// <summary>장치 고유번호로부터 32바이트 대칭키를 유도한다.</summary>
    public byte[] DeriveDeviceKey(string deviceCode) =>
        HKDF.DeriveKey(
            HashAlgorithmName.SHA256,
            Encoding.UTF8.GetBytes(MasterKey),
            outputLength: 32,
            salt: Encoding.UTF8.GetBytes(deviceCode),
            info: KdfInfo);

    /// <summary>객체를 JSON 직렬화 후 암호화해 base64 문자열로.</summary>
    public string EncryptForDevice(string deviceCode, object payload)
    {
        var key = DeriveDeviceKey(deviceCode);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(payload, JsonDefaults.SnakeCase);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];
        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, Encoding.UTF8.GetBytes(deviceCode));

        var envelope = new byte[1 + NonceSize + ciphertext.Length + TagSize];
        envelope[0] = EnvelopeVersion;
        nonce.CopyTo(envelope, 1);
        ciphertext.CopyTo(envelope, 1 + NonceSize);
        tag.CopyTo(envelope, 1 + NonceSize + ciphertext.Length);
        return Convert.ToBase64String(envelope);
    }

    /// <summary>base64 봉투를 복호화해 JSON 객체로.</summary>
    public JsonObject DecryptFromDevice(string deviceCode, string token)
    {
        byte[] envelope;
        try { envelope = Convert.FromBase64String(token); }
        catch (FormatException exc) { throw new DecryptException("잘못된 base64 형식"); }

        if (envelope.Length < 1 + NonceSize + TagSize)
            throw new DecryptException("봉투 길이가 too short");
        if (envelope[0] != EnvelopeVersion)
            throw new DecryptException($"지원하지 않는 봉투 버전: {envelope[0]}");

        var nonce = envelope.AsSpan(1, NonceSize);
        var ciphertext = envelope.AsSpan(1 + NonceSize, envelope.Length - 1 - NonceSize - TagSize);
        var tag = envelope.AsSpan(envelope.Length - TagSize, TagSize);
        var key = DeriveDeviceKey(deviceCode);
        var plaintext = new byte[ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, TagSize);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.UTF8.GetBytes(deviceCode));
        }
        catch (CryptographicException exc)
        {
            throw new DecryptException("복호화 실패(키 불일치 또는 변조)");
        }
        return JsonNode.Parse(plaintext)?.AsObject()
            ?? throw new DecryptException("JSON 이 아닙니다");
    }
}

public static class JsonDefaults
{
    /// <summary>API 응답과 같은 snake_case — 장치가 어느 서버와 말하든 같은 모양.</summary>
    public static readonly JsonSerializerOptions SnakeCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}
