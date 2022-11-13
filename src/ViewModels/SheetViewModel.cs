using notepad.Data;

namespace notepad.ViewModels;

public class SheetViewModel
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    public static SheetViewModel Map(Sheet sheet)
    {
        var model = new SheetViewModel();
        model.Id = sheet.Id;
        model.Title = sheet.Title ?? "";
        model.Text = sheet.Text ?? "";
        return model;
    }
}
