namespace Example.App;

/// <summary>The console app's entry point.</summary>
public static class Program
{
    /// <summary>Writes a greeting for the first argument, if any.</summary>
    /// <param name="args">The command-line arguments.</param>
    /// <returns>The exit code: 0.</returns>
    public static int Main(string[] args) => Run(args, Console.Out);

    /// <summary>Runs the app, writing to <paramref name="output"/>, so tests can read what it writes.</summary>
    /// <param name="args">The command-line arguments.</param>
    /// <param name="output">Where the greeting is written.</param>
    /// <returns>The exit code: 0.</returns>
    public static int Run(string[] args, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);
        output.WriteLine(Greeter.Greet(args.Length > 0 ? args[0] : null));
        return 0;
    }
}
