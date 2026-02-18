/**
 * useKeyboardInput - Handles keyboard input for navigation
 *
 * Listens for ESC key and triggers onBack callback
 */

import { useInput } from 'ink';

interface UseKeyboardInputOptions {
  onBack?: () => void;
  onToggleSubAgents?: () => void;
}

export function useKeyboardInput({ onBack, onToggleSubAgents }: UseKeyboardInputOptions): void {
  useInput((input, key) => {
    if (key.escape && onBack) {
      onBack();
    }

    if (input === 'a' && onToggleSubAgents) {
      onToggleSubAgents();
    }
  });
}
