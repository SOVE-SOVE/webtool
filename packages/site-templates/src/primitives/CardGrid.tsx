import type { ReactNode } from "react";

const COLUMN_CLASSES: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/** Generic responsive grid — a pure layout primitive. Sections decide
 * what each cell renders via renderItem, so this has no opinion about
 * card shape (icon card, photo card, pricing tier, ...). */
export function CardGrid<T>({
  items,
  renderItem,
  columns = 3,
  className = "",
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 gap-6 lg:gap-8 ${COLUMN_CLASSES[columns]} ${className}`}>
      {items.map((item, index) => (
        <div key={index}>{renderItem(item, index)}</div>
      ))}
    </div>
  );
}
