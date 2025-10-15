/**
 * useKeyboardInput - Handles keyboard input for navigation
 *
 * Listens for ESC key and triggers onBack callback
 */

import { useInput } from 'ink';

interface UseKeyboardInputOptions {
  onBack?: () => void;
}

export function useKeyboardInput({ onBack }: UseKeyboardInputOptions): void {
  useInput((input, key) => {
    if (key.escape && onBack) {
      onBack();
    }
  });
}
