using Example.App;

namespace Example.Tests;

public class ProgramTests
{
    [Fact]
    public void WritesAGreetingForTheFirstArgument()
    {
        using var output = new StringWriter();

        var code = Program.Run(["Ada"], output);

        Assert.Equal(0, code);
        Assert.Equal("Hello, Ada!" + Environment.NewLine, output.ToString());
    }

    [Fact]
    public void GreetsEveryoneWithoutArguments()
    {
        using var output = new StringWriter();

        Program.Run([], output);

        Assert.Equal("Hello, world!" + Environment.NewLine, output.ToString());
    }
}
