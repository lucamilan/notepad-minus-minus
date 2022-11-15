namespace notepad.Data
{
    public class Sheet
    {
        public int Id { get; set; }
        [System.ComponentModel.DataAnnotations.MaxLength(255)]
        public string? Title { get; set; }
        [System.ComponentModel.DataAnnotations.MaxLength(int.MaxValue)]
        public string? Text { get; set; } = "add new content here";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public bool IsEmpty() => "add new content here".Equals(Text, StringComparison.InvariantCultureIgnoreCase);
        public string Tooltip() => $"'{GetTitle(false)}' was created on {CreatedAt}";

        public void SetTitle()
        {
            Title = GetTitle(true);
        }

        private string? GetTitle(bool truncate = true)
        {
            if (IsEmpty() || string.IsNullOrWhiteSpace(Text)) return Title;
            var title = Text?.Trim().Split(new string[] { "\r\n", "\r", "\n" }, StringSplitOptions.None).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(title))
            {
                return Title;
            }
            return truncate ? Truncate(title, 27) : title;
        }

        private static string Truncate(string value, int maxLength, string postpend = "...")
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            return value.Length <= maxLength ? value : $"{value.Substring(0, maxLength)}{postpend}";
        }
    }
}