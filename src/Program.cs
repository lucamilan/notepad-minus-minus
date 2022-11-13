using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.JSInterop;
using MudBlazor.Services;
using notepad;
using notepad.Data;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
builder.Services.AddMudServices();
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddDbContextFactory<NotepadDbContext>(options =>
  options.UseSqlite($"Filename={DbConstants.SqliteDbFilename}")
         .LogTo(Console.WriteLine, LogLevel.Critical)
         .EnableSensitiveDataLogging());
builder.Services.AddScoped<DataSynchronizer>();

await builder.Build().RunAsync();
