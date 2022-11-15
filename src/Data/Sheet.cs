using Markdig;
using Markdig.Extensions.EmphasisExtras;
using System.ComponentModel.DataAnnotations;

namespace notepad.Data
{
    public class Sheet
    {
        private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
                .UseAutoLinks()
                .UseAdvancedExtensions()
                .UseEmphasisExtras(EmphasisExtraOptions.Default)
                .UseTaskLists()
                .UseAbbreviations()
                .UseDefinitionLists()
                .UseAutoIdentifiers()
                .UseEmojiAndSmiley()
                .UseSoftlineBreakAsHardlineBreak()
                .UseGridTables()
                .UseCustomContainers()
                .UseFigures()
                .UseFooters()
                .UseCitations()
                .Build();
        public int Id { get; set; }

        [MaxLength(255)]
        public string? Title { get; set; }

        [MaxLength(int.MaxValue)]
        public string? Text { get; set; } = "add new content here";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public bool IsEmpty() => "add new content here".Equals(Text, StringComparison.InvariantCultureIgnoreCase);

        public string Tooltip() => $"'{GetTitle(false)}' was created on {CreatedAt}";

        public string Preview => Markdown.ToHtml(Text ?? "## No Content here!", Pipeline);
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
            var safeTitle = Markdown.ToPlainText(Title ?? "", Pipeline);
            if (IsEmpty() || string.IsNullOrWhiteSpace(Text)) return safeTitle;
            var title = Text?.Trim().Split(new string[] { "\r\n", "\r", "\n" }, StringSplitOptions.None).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(title))
            {
                return safeTitle;
            }
            safeTitle = Markdown.ToPlainText(title ?? "", Pipeline);
            return truncate ? Truncate(safeTitle, 27) : safeTitle;
        }

        private static string Truncate(string value, int maxLength, string postpend = "...")
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            return value.Length <= maxLength ? value : $"{value.Substring(0, maxLength)}{postpend}";
        }
    }
}