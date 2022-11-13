using Microsoft.AspNetCore.Components;
using Microsoft.EntityFrameworkCore;
using MudBlazor;
using notepad.Data;

namespace notepad.Pages
{
    public partial class Index
    {
        private List<Sheet> _sheets = new();
        private MudDynamicTabs? _tabsReference = null!;
        [Inject]
        private DataSynchronizer DataSynchronizer { get; set; } = null!;
        [Inject]
        private ILogger<Index> Log { get; set; } = null!;
        private bool _updateIndex = false;
        private bool _isLoading = true;
        private int _index = 0;
        protected override async Task OnInitializedAsync()
        {
            await using var db = await DataSynchronizer.GetPreparedDbContextAsync();

            _sheets = await db.Sheets.ToListAsync();

            if (!_sheets.Any())
            {
                var newSheet = AddNewSheet();
                db.Sheets.Add(newSheet);
                await db.SaveChangesAsync();
                Log.LogInformation("First sheet was added");
            }

            InitializePageRequestTimer();

            Log.LogInformation($"Sheets count: {_sheets.Count}");

            _isLoading = false;
        }

        private void InitializePageRequestTimer()
        {
            int _autoSaveInterval = 1000 * 5;
            var timer = new Timer(async (object? stateInfo) =>
            {
                await InvokeAsync(async () =>
                {
                    await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
                    _sheets.ForEach(_ => db.Entry(_).State = EntityState.Modified);
                    await db.SaveChangesAsync();
                    Log.LogInformation("Autosave");
                });

            }, new AutoResetEvent(false), _autoSaveInterval, _autoSaveInterval);
        }

        private Sheet AddNewSheet()
        {
            var counter = _sheets.Count + 1;

            var newSheet = new Sheet { Title = $"Sheet {counter}", Text = "add new content here" };

            _sheets.Add(newSheet);

            _updateIndex = true;

            Log.LogInformation("Empty sheet was added");

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

        private async Task AddTabCallback()
        {
            await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
            var newSheet = AddNewSheet();
            db.Sheets.Add(newSheet);
            await db.SaveChangesAsync();
        }

        private async Task CloseTabCallback(MudTabPanel panel)
        {
            var sheet = _sheets.FirstOrDefault(x => x.Id == (int)panel.Tag);
            if (sheet != null)
            {
                await using var db = await DataSynchronizer.GetPreparedDbContextAsync();
                db.Entry(sheet).State = EntityState.Deleted;
                await db.SaveChangesAsync();
                _sheets.Remove(sheet);
            }
        }

        protected async Task OnTextChangeHandler(string newValue)
        {
            Log.LogInformation($"Panel Index:{_index} Value: {newValue}");
            await Task.Delay(1);
        }
    }
}