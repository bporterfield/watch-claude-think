import React, { useState, useCallback } from 'react';
import { Box, useInput } from 'ink';

interface Item {
  label: string;
  value: string;
  key?: string;
}

interface NonWrappingSelectInputProps {
  items: Item[];
  onSelect: (item: Item) => void;
  itemComponent: React.ComponentType<{ isSelected: boolean; label: string; value: string }>;
  limit?: number;
  isFocused?: boolean;
  initialIndex?: number;
}

export const NonWrappingSelectInput: React.FC<NonWrappingSelectInputProps> = ({
  items = [],
  onSelect,
  itemComponent: ItemComponent,
  limit: customLimit,
  isFocused = true,
  initialIndex = 0,
}) => {
  const hasLimit = typeof customLimit === 'number' && items.length > customLimit;
  const visibleCount = hasLimit ? Math.min(customLimit!, items.length) : items.length;

  // scrollOffset tracks which item from the full list appears at top of window
  const [scrollOffset, setScrollOffset] = useState(0);
  // selectedIndex is relative to the visible window (0 to visibleCount-1)
  const [selectedIndex, setSelectedIndex] = useState(
    initialIndex < visibleCount ? initialIndex : 0
  );

  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleCount);

  useInput(
    useCallback(
      (input, key) => {
        if (input === 'k' || key.upArrow) {
          const atTopOfWindow = selectedIndex === 0;
          const atTopOfList = scrollOffset === 0;

          if (atTopOfWindow && !atTopOfList) {
            // At top of window but not top of list - scroll up
            setScrollOffset(scrollOffset - 1);
          } else if (!atTopOfWindow) {
            // Not at top of window - move selection up
            setSelectedIndex(selectedIndex - 1);
          }
          // If at top of both window and list, do nothing (no wrap)
        }

        if (input === 'j' || key.downArrow) {
          const atBottomOfWindow = selectedIndex === visibleCount - 1;
          const atBottomOfList = scrollOffset + visibleCount >= items.length;

          if (atBottomOfWindow && !atBottomOfList) {
            // At bottom of window but not bottom of list - scroll down
            setScrollOffset(scrollOffset + 1);
          } else if (!atBottomOfWindow) {
            // Not at bottom of window - move selection down
            setSelectedIndex(selectedIndex + 1);
          }
          // If at bottom of both window and list, do nothing (no wrap)
        }

        if (key.return) {
          const selectedItem = visibleItems[selectedIndex];
          if (selectedItem) {
            onSelect(selectedItem);
          }
        }
      },
      [selectedIndex, scrollOffset, visibleCount, items.length, visibleItems, onSelect]
    ),
    { isActive: isFocused }
  );

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={item.key ?? item.value}>
            <ItemComponent {...item} isSelected={isSelected} />
          </Box>
        );
      })}
    </Box>
  );
};
