using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Engosoft.Learn.Api.Common;

/// <summary>Work that must not hold up a request (push delivery, Odoo syncs from webhooks). Each job gets its own scope.</summary>
public sealed class BackgroundJobQueue
{
    private readonly Channel<(string Name, Func<IServiceProvider, CancellationToken, Task> Work)> _channel =
        Channel.CreateBounded<(string, Func<IServiceProvider, CancellationToken, Task>)>(new BoundedChannelOptions(10_000)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
        });

    public void Enqueue(string name, Func<IServiceProvider, CancellationToken, Task> work) => _channel.Writer.TryWrite((name, work));

    public IAsyncEnumerable<(string Name, Func<IServiceProvider, CancellationToken, Task> Work)> ReadAllAsync(CancellationToken ct) =>
        _channel.Reader.ReadAllAsync(ct);
}

public sealed class BackgroundJobWorker(BackgroundJobQueue queue, IServiceScopeFactory scopes, ILogger<BackgroundJobWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (name, work) in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await work(scope.ServiceProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Background job {Job} failed", name); }
        }
    }
}

/// <summary>One lock per key, so two syncs of the same course never race (single-instance deployment).</summary>
public sealed class KeyedLocks
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> AcquireAsync(string key, CancellationToken ct)
    {
        var s = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await s.WaitAsync(ct);
        return new Releaser(s);
    }

    private sealed class Releaser(SemaphoreSlim s) : IDisposable
    {
        public void Dispose() => s.Release();
    }
}
