# Contributing to Media Director

Thank you for your interest in contributing to the Media Director VS Code extension!

## Development Setup

1. Clone the repository:
   ```bash
   git clone git@github.com:liquitive/media-director.git
   cd media-director
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run compile
   ```

4. Debug the extension:
   - Press F5 in VS Code
   - This launches Extension Development Host

## Project Structure

- `src/` - TypeScript source code
- `out/` - Compiled JavaScript (git-ignored)
- `python/` - Python audio analysis scripts
- `media/` - Extension icons and assets
- `.github/` - GitHub templates and workflows

## Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
3. Test thoroughly in both VS Code and Cursor
4. Update documentation if needed
5. Submit a pull request

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add comments for complex logic
- Update documentation as needed
- Test in both VS Code and Cursor

## Testing Checklist

Before submitting a PR, ensure:
- [ ] Extension compiles without errors
- [ ] All features work in VS Code
- [ ] All features work in Cursor
- [ ] No console errors in Developer Tools
- [ ] Documentation is updated
- [ ] No breaking changes

## Reporting Issues

When reporting bugs, please include:
- VS Code/Cursor version
- Extension version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

## Feature Requests

We welcome feature requests! Please:
- Check existing issues first
- Describe the use case
- Explain how it fits the project's goals
- Consider implementation complexity

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow the golden rule

Thank you for contributing! 🚀
