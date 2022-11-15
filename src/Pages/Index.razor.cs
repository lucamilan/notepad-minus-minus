using Microsoft.AspNetCore.Components;
using Microsoft.EntityFrameworkCore;
using MudBlazor;
using notepad.Data;
using notepad.Shared;

namespace notepad.Pages
{
    public partial class Index : IDisposable
    {
        private Dictionary<int, bool> _previewMarkdown = new();
        private bool _autoSaveOn = false;
        private PeriodicTimer? _periodicTimer;
        private List<Sheet> _sheets = new();
        private MudDynamicTabs? _tabsRef = null!;
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

            Log.LogInformation($"PreviewMarkdown {id} is on: {value}");
        }

        protected async void RunTimer()
        {
            if (_periodicTimer is null) return;

            while (await _periodicTimer.WaitForNextTickAsync())
            {
                await UpdateSheets(_sheets);
                await InvokeAsync(StateHasChanged);
                Log.LogInformation("Doc automatically saved");
            }
        }

        private async Task OnSaveAll()
        {
            _isLoading = true;
            await UpdateSheets(_sheets);
            await InvokeAsync(StateHasChanged);
            _isLoading = false;
            Log.LogInformation("Doc globally saved");
        }

        private Task OnAutoSaveEnabled(bool value)
        {
            _autoSaveOn = value;
            _periodicTimer?.Dispose();
            if (_autoSaveOn)
            {
                Log.LogInformation($"Enable autosave status on: {_autoSaveOn}");
                _periodicTimer = new(TimeSpan.FromSeconds(10));
                RunTimer();
            }
            return Task.CompletedTask;
        }

        public void Dispose()
        {
            Notifier.SaveAll -= OnSaveAll;
            Notifier.AutoSaveEnabled -= OnAutoSaveEnabled;
            _periodicTimer?.Dispose();
        }

        private Sheet CreateEmptySheet()
        {
            var counter = _sheets.Count + 1;

            var newSheet = new Sheet { 
                Text = $"# Sample note {Environment.NewLine} You can also *write* your note using basic markdown syntax."
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

        private async Task UpdateSheets(IEnumerable<Sheet> sheets)
        {
            await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
            sheets.Where(_ => !_.IsEmpty()).ToList().ForEach(_ => db.Entry(_).State = EntityState.Modified);
            await db.SaveChangesAsync();
            _isLoading = false;
        }
    }
}