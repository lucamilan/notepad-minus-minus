using System.Runtime.InteropServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.JSInterop;

namespace notepad.Data;

public class DataSynchronizer
{
    private readonly Task _firstTimeSetupTask;

    private readonly IDbContextFactory<NotepadDbContext> _dbContextFactory;
    private readonly ILogger<DataSynchronizer> _logger;

    public DataSynchronizer(IJSRuntime js, IDbContextFactory<NotepadDbContext> dbContextFactory, ILogger<DataSynchronizer> logger)
    {
        _dbContextFactory = dbContextFactory;
        _logger = logger;
        _firstTimeSetupTask = FirstTimeSetupAsync(js);
    }

    public async Task<NotepadDbContext> GetPreparedDbContextAsync()
    {
        await _firstTimeSetupTask;
        return await _dbContextFactory.CreateDbContextAsync();
    }

    private async Task FirstTimeSetupAsync(IJSRuntime js)
    {
        var module = await js.InvokeAsync<IJSObjectReference>("import", "./dbstorage.js");

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Create("browser")))
        {
            await module.InvokeVoidAsync("synchronizeFileWithIndexedDb", DbConstants.SqliteDbFilename);
        }

        await using var db = await _dbContextFactory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();
 
         _logger.LogWarning($"Successfully syncronized SQLite database file '{DbConstants.SqliteDbFilename}' in browser");
    }
}