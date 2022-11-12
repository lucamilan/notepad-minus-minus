using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.JSInterop;
using notepad;
using notepad.Data;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

builder.Services.AddDbContextFactory<NotepadDbContext>(options =>
  options.UseSqlite($"Filename={DbConstants.SqliteDbFilename}")
         .EnableSensitiveDataLogging());

var host = builder.Build();

await InitDatabaseOnBrowser(host);

await host.RunAsync();

async Task InitDatabaseOnBrowser(WebAssemblyHost host)
{
    if (!RuntimeInformation.IsOSPlatform(OSPlatform.Create("browser")))
    {
        return;
    }

    var logger = host.Services.GetRequiredService<ILogger<Program>>();

    try
    {
        var jsRuntime = host.Services.GetRequiredService<IJSRuntime>();
        var module = await jsRuntime.InvokeAsync<IJSObjectReference>("import", "./dbstorage.js");
        await module.InvokeVoidAsync("createSqLiteFile", DbConstants.SqliteDbFilename);
        logger.LogInformation($"Successfully create SQLite database file '{DbConstants.SqliteDbFilename}' in browser");
    }
    catch (Exception ex)
    {
        logger.LogCritical("Cannot create SQLite database file on browser",ex);
    }
}