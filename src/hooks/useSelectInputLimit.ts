/**
 * useSelectInputLimit - Calculate dynamic list limit based on terminal height
 *
 * Ensures select input lists fit within terminal viewport by calculating
 * available rows after reserving space for header and footer.
 */

import { useState, useEffect } from 'react';
import { SELECT_INPUT_VISIBLE_LIMIT, DEFAULT_TERMINAL_HEIGHT } from '../lib/constants.js';

/**
 * Rows reserved for header text and margins
 * Example: "Select a project:" + marginBottom
 */
const HEADER_ROWS = 2;

/**
 * Rows reserved for footer text and margins
 * Example: "Ctrl+C to exit" + marginTop
 */
const FOOTER_ROWS = 2;

/**
 * Minimum number of items to show in list
 * Ensures usability even in very small terminals
 */
const MIN_ITEMS = 3;

/**
 * Calculate optimal list limit based on terminal height
 *
 * @param terminalHeight - Current terminal height in rows
 * @param rowsPerItem - Number of rows each item occupies (default: 1)
 * @returns Number of items that fit in viewport
 */
function calculateLimit(terminalHeight: number, rowsPerItem: number): number {
  const availableRows = terminalHeight - HEADER_ROWS - FOOTER_ROWS;
  const limit = Math.max(MIN_ITEMS, Math.floor(availableRows / rowsPerItem));

  // Cap at SELECT_INPUT_VISIBLE_LIMIT to maintain existing behavior on large terminals
  return Math.min(limit, SELECT_INPUT_VISIBLE_LIMIT);
}

/**
 * Hook that returns dynamic list limit based on current terminal height
 *
 * Automatically updates when terminal is resized.
 *
 * @param rowsPerItem - Number of rows each item occupies in the list (default: 1)
 * @returns Current optimal limit for select input lists
 */
export function useSelectInputLimit(rowsPerItem = 1): number {
  const [limit, setLimit] = useState(() =>
    calculateLimit(process.stdout.rows ?? DEFAULT_TERMINAL_HEIGHT, rowsPerItem)
  );

  useEffect(() => {
    const handleResize = () => {
      const newHeight = process.stdout.rows ?? DEFAULT_TERMINAL_HEIGHT;
      const newLimit = calculateLimit(newHeight, rowsPerItem);
      setLimit(newLimit);
    };

    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [rowsPerItem]);

  return limit;
}
