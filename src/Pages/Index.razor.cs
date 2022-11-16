using Microsoft.AspNetCore.Components;
using Microsoft.EntityFrameworkCore;
using MudBlazor;
using notepad.Data;
using notepad.Shared;
using notepad.Services;

namespace notepad.Pages;

public partial class Index : IDisposable
{
    private Dictionary<int, bool> _previewMarkdown = new();
    private bool _autoSaveOn = false;
    [Inject]
    private IConfiguration Config { get; set; } = null!;
    [Inject]
    private ISnackbar Snackbar { get; set; } = null!;
    private PeriodicTimer? _periodicTimer;
    private List<Sheet> _sheets = new();
    private MudDynamicTabs? _sheetsRef = null!;
    [Inject]
    private IDialogService DialogService { get; set; } = null!;
    [Inject]
    private DataSynchronizer DataSynchronizer { get; set; } = null!;
    [Inject]
    private EventNotifier Notifier { get; set; } = null!;
    [Inject]
    private ILogger<Index> Log { get; set; } = null!;
    private bool _updateIndex = false;
    private bool _isLoading = true;
    private int _index = 0;
    protected override async Task OnInitializedAsync()
    {
        Notifier.SaveAll += OnSaveAll;
        Notifier.AutoSaveEnabled += OnAutoSaveEnabled;

        await using var db = await DataSynchronizer.GetPreparedDbContextAsync();

        _sheets = await db.Sheets.ToListAsync();

        if (!_sheets.Any())
        {
            var sheet = CreateEmptySheet();
            await AddSheet(sheet);
            _sheets.Add(sheet);
            Log.LogInformation("First sheet was added");
        }

        _isLoading = false;

        _autoSaveOn = Config["Autosave_Enabled"] == bool.TrueString;

        await Notifier.ShowSpinnerAsync(_isLoading);

        await OnAutoSaveEnabled(_autoSaveOn);

        await Notifier.AutoSaveEnabledAsync(_autoSaveOn);
    }

    private bool CanShowMarkdownPreview(int sheetId)
    {
        return _previewMarkdown.TryGetValue(sheetId, out bool preview) && preview;
    }

    private void OnShowMarkdownPreview()
    {
        var value = true;
        var id = _sheets[_index].Id;

        if (_previewMarkdown.TryGetValue(id, out bool preview) && _previewMarkdown.Remove(id))
        {
            value = !preview;
        }

        _previewMarkdown.TryAdd(id, value);

        Log.LogInformation($"PreviewMarkdown for sheetId '{id}' is on: {value}");
    }

    protected async void RunTimer()
    {
        if (_periodicTimer is not null) while (await _periodicTimer.WaitForNextTickAsync())
            {
                await UpdateSheets(_sheets);
                Log.LogInformation("Sheets was saved automatically");
            }
    }
    private async Task OnSaveAll()
    {
        await Notifier.ShowSpinnerAsync(true);
        await UpdateSheets(_sheets);
        Log.LogInformation("Sheets was saved");
        await Notifier.ShowSpinnerAsync(false);
        Snackbar.Add("All notes was saved!", Severity.Warning, config =>
        {
            config.Icon = Icons.Filled.Announcement;
            config.IconColor = Color.Dark;
            config.IconSize = Size.Large;
        });
    }

    private Task OnAutoSaveEnabled(bool value)
    {
        Log.LogInformation($"Autosave is on: {value}");
        _autoSaveOn = value;
        _periodicTimer?.Dispose();
        if (_autoSaveOn)
        {
            _periodicTimer = new(GetAutoSaveInterval());
            RunTimer();
        }
        return Task.CompletedTask;
    }

    private TimeSpan GetAutoSaveInterval()
    {
        var interval = Config["Autosave_Interval_In_Seconds"] ?? "60";
        return TimeSpan.FromSeconds(int.Parse(interval));
    }

    public void Dispose()
    {
        Notifier.SaveAll -= OnSaveAll;
        Notifier.AutoSaveEnabled -= OnAutoSaveEnabled;
        _periodicTimer?.Dispose();
        Log.LogInformation($"Dispose was called");
    }

    private Sheet CreateEmptySheet()
    {
        var counter = _sheets.Count + 1;

        var newSheet = new Sheet
        {
            Title = "Sample note",
            Text = $"# Sample note{Environment.NewLine}You can also *write* your note using basic markdown syntax."
        };

        _updateIndex = true;

        Log.LogInformation("New empty sheet was added");

        return newSheet;
    }

    protected override void OnAfterRender(bool firstRender)
    {
        if (_updateIndex == true)
        {
            _index = _sheets.Count - 1;
            StateHasChanged();
            _updateIndex = false;
        }
    }

    private async Task AddSheetCallback()
    {
        var sheet = CreateEmptySheet();
        await AddSheet(sheet);
        _sheets.Add(sheet);
    }

    private async Task RemoveSheetCallback(MudTabPanel panel)
    {
        var sheet = _sheets.FirstOrDefault(x => x.Id == (int)panel.Tag);
        if (sheet != null)
        {
            if (!sheet.IsEmpty())
            {
                var result = await (DialogService.Show<DialogConfirm>("Confirm", new DialogParameters())).Result;
                if (result.Cancelled || !bool.TryParse(result.Data.ToString(), out bool _)) return;
            }

            await RemoveSheet(sheet);
            _sheets.Remove(sheet);

            if (_sheets.Count == 0)
            {
                sheet = CreateEmptySheet();
                await AddSheet(sheet);
                _sheets.Add(sheet);
            }
        }
    }

    protected async Task OnTextChangeHandler(string newValue)
    {
        if (_index >= 0) _sheets[_index].SetTitle();
        await Task.Delay(1);
    }

    private async Task RemoveSheet(Sheet sheet)
    {
        await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
        db.Entry(sheet).State = EntityState.Deleted;
        await db.SaveChangesAsync();
        _isLoading = false;
    }

    private async Task AddSheet(Sheet sheet)
    {
        await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
        db.Entry(sheet).State = EntityState.Added;
        await db.SaveChangesAsync();
        _isLoading = false;
    }

    private async Task UpdateSheets(List<Sheet> sheets)
    {
        await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
        sheets.ForEach(_ => db.Entry(_).State = EntityState.Modified);
        await db.SaveChangesAsync();
        _isLoading = false;
    }
}