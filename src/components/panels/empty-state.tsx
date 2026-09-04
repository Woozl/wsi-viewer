export function EmptyState({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>;
}
