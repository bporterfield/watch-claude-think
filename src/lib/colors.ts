import chalk, { type ChalkInstance } from "chalk";
import type { ProjectInfo } from "./file-system.js";

// List of distinct colors ordered to maximize contrast between adjacent entries
// Colors are arranged so that similar hues are far apart in the array
const PROJECT_COLORS = [
  chalk.cyanBright,      // 0: bright cyan
  chalk.redBright,       // 1: bright red
  chalk.greenBright,     // 2: bright green
  chalk.magentaBright,   // 3: bright magenta
  chalk.yellowBright,    // 4: bright yellow
  chalk.blueBright,      // 5: bright blue
  chalk.hex('#FF6B6B'),  // 6: coral
  chalk.hex('#4ECDC4'),  // 7: turquoise
  chalk.hex('#FFE66D'),  // 8: sunshine yellow
  chalk.hex('#95E1D3'),  // 9: light sea green
  chalk.red,             // 10: red
  chalk.cyan,            // 11: cyan
  chalk.magenta,         // 12: magenta
  chalk.green,           // 13: green
  chalk.hex('#FF8B94'),  // 14: light coral
  chalk.blue,            // 15: blue
  chalk.yellow,          // 16: yellow
  chalk.hex('#A8E6CF'),  // 17: mint
];

/**
 * Simple hash function to convert string to number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Shared registry for project color assignments
 * This ensures colors stay consistent between ProjectSelector and Footer
 */
const projectColorRegistry = new Map<string, ChalkInstance>();

/**
 * Get the assigned color for a project, or use hash-based fallback
 * Looks up the color in the registry first (from assignProjectColors),
 * falls back to hash-based assignment if not found
 */
export function getProjectColor(projectName: string): ChalkInstance {
  // First check if we have an assigned color in the registry
  const registeredColor = projectColorRegistry.get(projectName);
  if (registeredColor) {
    return registeredColor;
  }

  // Fallback to hash-based assignment for projects not in registry
  const hash = hashString(projectName);
  const colorIndex = hash % PROJECT_COLORS.length;
  return PROJECT_COLORS[colorIndex] ?? chalk.white;
}

/**
 * Assign colors to a list of projects to maximize contrast between adjacent entries
 * Returns a map of project name -> color function
 * This ensures adjacent projects in the list have maximally different colors
 *
 * Also stores the assignments in the shared registry so getProjectColor()
 * can return the same colors used in the selector
 */
export function assignProjectColors(projects: ProjectInfo[]): Map<string, ChalkInstance> {
  const colorMap = new Map<string, ChalkInstance>();

  projects.forEach((project, index) => {
    // Assign colors sequentially from the pre-ordered palette
    const colorIndex = index % PROJECT_COLORS.length;
    const color = PROJECT_COLORS[colorIndex] ?? chalk.white;

    colorMap.set(project.name, color);
    // Store in registry for getProjectColor to use
    projectColorRegistry.set(project.name, color);
  });

  return colorMap;
}

/**
 * Assign unique colors to active sessions to ensure each running session has a distinct color
 * Returns a map of session identifier -> color function
 * Limited to 10 different colors to maintain readability
 *
 * @param sessionIds - Array of unique session identifiers (e.g., session paths)
 * @param excludeColor - Optional color to exclude from the palette (e.g., the project's color)
 */
export function assignSessionColors(
  sessionIds: string[],
  excludeColor?: ChalkInstance,
): Map<string, ChalkInstance> {
  const colorMap = new Map<string, ChalkInstance>();

  // Filter out the excluded color from the palette
  const availableColors = excludeColor
    ? PROJECT_COLORS.filter((color) => color !== excludeColor)
    : PROJECT_COLORS;

  const maxColors = Math.min(10, availableColors.length);

  sessionIds.forEach((sessionId, index) => {
    // Assign colors sequentially, wrapping after maxColors
    const colorIndex = index % maxColors;
    colorMap.set(sessionId, availableColors[colorIndex] ?? chalk.white);
  });

  return colorMap;
}
