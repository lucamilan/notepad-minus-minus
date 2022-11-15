
namespace notepad;

public class EventNotifier
{
    public event Func<Task> SaveAll = null!;
    public event Func<bool, Task> AutoSaveEnabled = null!;

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