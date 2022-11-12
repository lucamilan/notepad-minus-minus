using Microsoft.EntityFrameworkCore;

namespace notepad.Data;

public class NotepadDbContext : DbContext
{
    public NotepadDbContext(DbContextOptions<NotepadDbContext> options) : base(options)
    {

    }
    public DbSet<Sheet> Sheets => Set<Sheet>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Sheet>(
            record =>
            {
                record.HasKey(x => x.Id);
                record.Property(x => x.Id).ValueGeneratedOnAdd();
            });
        base.OnModelCreating(modelBuilder);
    }
}
