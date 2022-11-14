
namespace notepad;

public class EventNotifier
{
    public event Func<Task> SaveAll;

    public async Task SaveAllAsync()
    {
        if (SaveAll is { })
        {
            await SaveAll.Invoke();
        }
    }
}