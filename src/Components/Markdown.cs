using Markdig;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using notepad.Services;

namespace notepad.Components;

public class Markdown : ComponentBase
{
    [Parameter]
    public string Text { get; set; } = null!;

    private MarkupString _markupString = new MarkupString();

    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        base.BuildRenderTree(builder);
        builder.AddContent(0, _markupString);
    }

    protected override void OnParametersSet()
    {
        base.OnParametersSet();
        _markupString = MarkdownService.ToHtml(Text);
    }
}