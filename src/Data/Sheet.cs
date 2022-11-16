using notepad.Services;
using System.ComponentModel.DataAnnotations;

namespace notepad.Data
{
    public class Sheet
    {
        public int Id { get; set; }

        [MaxLength(255)]
        public string? Title { get; set; }

        [MaxLength(int.MaxValue)]
        public string? Text { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public bool IsEmpty() => GetTitle(false)?.StartsWith("Sample note", StringComparison.InvariantCultureIgnoreCase) == true;

        public string Tooltip() => $"'{GetTitle(false)}' was created on {CreatedAt}";

        public void SetTitle()
        {
            Title = GetTitle(true);
        }

        public int GetRows()
        {
            int maxRows = 25;
            int minRows = 15;
            var text = Text ?? "";
            var rowCount = Math.Max(text.Split('\n').Length, text.Split('\r').Length);
            return Math.Min(Math.Max(rowCount, minRows), maxRows);
        }

        private string? GetTitle(bool truncate = true)
        {
            var safeTitle = MarkdownService.ToPlainText(Title);
            if (string.IsNullOrWhiteSpace(Text)) return safeTitle;
            var title = Text?.Trim().Split(new string[] { "\r\n", "\r", "\n" }, StringSplitOptions.None).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(title))
            {
                return safeTitle;
            }
            safeTitle = MarkdownService.ToPlainText(title);
            return truncate ? Truncate(safeTitle, 27) : safeTitle;
        }

        private static string Truncate(string value, int maxLength, string postpend = "...")
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            return value.Length <= maxLength ? value : $"{value.Substring(0, maxLength)}{postpend}";
        }
    }
}