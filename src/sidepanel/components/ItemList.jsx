// Mirrors the old sidepanel.js's renderList helper -- renderItem returns either a string/node or an
// array of children (matching the old code's `item.append(...renderItemNodes(data))` idiom).
export function ItemList({ items, emptyMessage, renderItem, className }) {
  if (!items?.length) {
    return (
      <ul className={className}>
        <li>{emptyMessage}</li>
      </ul>
    );
  }

  return (
    <ul className={className}>
      {items.map((item, index) => {
        const content = renderItem(item, index);
        return <li key={index}>{Array.isArray(content) ? content : [content]}</li>;
      })}
    </ul>
  );
}
