namespace Example;

/// <summary>Builds greetings. A starter: replace it with the project's own code.</summary>
public static class Greeter
{
    /// <summary>Returns a greeting for <paramref name="name"/>.</summary>
    /// <param name="name">Who to greet. Blank means everyone.</param>
    /// <returns>The greeting, for example "Hello, Ada!".</returns>
    public static string Greet(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return "Hello, world!";
        }

        return $"Hello, {name.Trim()}!";
    }
}
