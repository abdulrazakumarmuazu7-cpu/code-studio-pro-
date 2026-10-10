export function processTerminalCommand(command, fileSystem) {
  const commandName = command.trim().split(/\s+/)[0]?.toLowerCase();

  switch (commandName) {
    case 'help':
      return { text: 'Available commands: help, ls, pwd, build, export, version' };
    case 'version':
      return { text: 'Code Studio Pro v2.0.0' };
    case 'build':
      return { text: 'Preview refresh requested.' };
    case 'export':
      return { text: 'Project export started.' };
    default:
      return { text: `Command not found: ${commandName || 'unknown'}` }; 
  }
}
