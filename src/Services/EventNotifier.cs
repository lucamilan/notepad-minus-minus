namespace notepad.Services;

public class EventNotifier
{
    public event Func<bool, Task> ShowSpinner = null!;
    public event Func<Task> SaveAll = null!;
    public event Func<bool, Task> AutoSaveEnabled = null!;

    public async Task ShowSpinnerAsync(bool value)
    {
        if (ShowSpinner is { })
        {
            await ShowSpinner.Invoke(value);
        }
    }

    public async Task AutoSaveEnabledAsync(bool value)
    {
        if (AutoSaveEnabled is { })
        {
            await AutoSaveEnabled.Invoke(value);
        }
    }

    public async Task SaveAllAsync()
    {
        if (SaveAll is { })
        {
            await SaveAll.Invoke();
        }
    }
}