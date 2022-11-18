using System.Runtime.InteropServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.JSInterop;

namespace notepad.Data;

public class DataSynchronizer
{
    private readonly Task _firstTimeSetupTask;
    private readonly IJSRuntime _jsRuntime;
    private readonly IDbContextFactory<NotepadDbContext> _dbContextFactory;
    private readonly ILogger<DataSynchronizer> _logger;

    public DataSynchronizer(IJSRuntime jsRuntime, IDbContextFactory<NotepadDbContext> dbContextFactory, ILogger<DataSynchronizer> logger)
    {
        _jsRuntime = jsRuntime;
        _dbContextFactory = dbContextFactory;
        _logger = logger;
        _firstTimeSetupTask = FirstTimeSetupAsync();
    }

    public async Task<NotepadDbContext> GetPreparedDbContextAsync()
    {
        await _firstTimeSetupTask;
        return await _dbContextFactory.CreateDbContextAsync();
    }

    private async Task FirstTimeSetupAsync()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Create("browser")))
        {
            var module = await _jsRuntime.InvokeAsync<IJSObjectReference>("import", "./dbstorage.js");
            await module.InvokeVoidAsync("synchronizeFileWithIndexedDb", DbConstants.SqliteDbFilename);            
            await module.DisposeAsync();
            _logger.LogWarning($"Successfully disposed dbstorage.js");
        }

        await using var db = await _dbContextFactory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();

        _logger.LogWarning($"Successfully syncronized SQLite database file '{DbConstants.SqliteDbFilename}' in browser");
    }
}