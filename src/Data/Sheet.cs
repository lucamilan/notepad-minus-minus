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
    }
}