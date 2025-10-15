import chalk from 'chalk';

/**
 * Shared markedTerminal configuration
 * Used across all markdown parsers to ensure consistent rendering
 */
export function getMarkedTerminalConfig(contentWidth: number) {
  return {
    code: chalk.bgHex('#1e1e1e').white,
    blockquote: chalk.gray.italic,
    codespan: chalk.cyan,
    strong: chalk.bold,
    em: chalk.italic,
    width: contentWidth,
    reflowText: true,
    listitem: chalk.reset,
    list: (body: string, _ordered: boolean) => {
      // Replicate default marked-terminal behavior but with custom bullet character
      body = body.trim();
      // Split, filter empty lines, replace asterisks with bullets, rejoin
      return body
        .split('\n')
        .filter((line) => line.length > 0)  // Remove empty lines
        .map((line) => line.replace(/^\* /, '• '))
        .join('\n');
    },
  };
}
