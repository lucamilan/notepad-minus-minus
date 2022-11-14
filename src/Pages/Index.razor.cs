using Microsoft.AspNetCore.Components;
using Microsoft.EntityFrameworkCore;
using MudBlazor;
using notepad.Data;

namespace notepad.Pages
{
    public partial class Index
    {
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

        private async Task OnSaveAll()
        {
            _isLoading = true;

            await InvokeAsync(async () =>
            {
                await UpdateSheets(_sheets);
                StateHasChanged();
                _isLoading = false;
                Log.LogInformation("Doc globally saved");
            });
        }

        public void Dispose()
        {
            Notifier.SaveAll -= OnSaveAll;
        }

        private Sheet CreateEmptySheet()
        {
            var counter = _sheets.Count + 1;

            var newSheet = new Sheet { Title = $"Sheet {counter}" };

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
                var result = await (DialogService.Show<DialogConfirm>("Confirm", new DialogParameters())).Result;
                if (result.Cancelled || !bool.TryParse(result.Data.ToString(), out bool _)) return;

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
            Log.LogInformation($"Panel Index:{_index} Value: {newValue}");
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
        }
    }
}