using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace SignalLink.Player;

public partial class App : Application
{
    /// <summary>무인 장치다 — 죽는 대신 로그를 남기고 계속 산다.</summary>
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += OnUnhandledException;
        base.OnStartup(e);
    }

    private static void OnUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SignalLinkPlayer");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "player-errors.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {e.Exception}\r\n");
        }
        catch
        {
            // 로그마저 못 쓰는 상황 — 표출이 우선이다.
        }
        e.Handled = true;
    }
}
