using Markdig;
using Markdig.Extensions.EmphasisExtras;
using Microsoft.AspNetCore.Components;

namespace notepad.Services;


public class MarkdownService
{
    internal static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
                .UseAutoLinks()
                .UseEmphasisExtras(EmphasisExtraOptions.Default)
                .UseTaskLists()
                .UseAbbreviations()
                .UseDefinitionLists()
                .UseAutoIdentifiers()
                .UseSoftlineBreakAsHardlineBreak()
                .UseGridTables()
                .UseCustomContainers()
                .UseFigures()
                .UseFooters()
                .UseCitations()
                .UseEmojiAndSmiley()
                .UseAdvancedExtensions()
                .Build();

    public static string ToPlainText(string? markdown)
    {
        return Markdown.ToPlainText(markdown ?? "", Pipeline);
    }

    public static MarkupString ToHtml(string? markdown)
    {
        return new MarkupString(Markdown.ToHtml(markdown ?? "# No markdown content here", Pipeline));
    }
}