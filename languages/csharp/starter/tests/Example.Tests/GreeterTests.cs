namespace Example.Tests;

public class GreeterTests
{
    [Fact]
    public void GreetsTheNameGiven()
    {
        Assert.Equal("Hello, Ada!", Greeter.Greet("Ada"));
    }

    [Fact]
    public void TrimsTheName()
    {
        Assert.Equal("Hello, Ada!", Greeter.Greet("  Ada "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void GreetsEveryoneWithoutAName(string? name)
    {
        Assert.Equal("Hello, world!", Greeter.Greet(name));
    }
}
