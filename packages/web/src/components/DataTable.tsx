import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, type ReactNode } from "react";
import { useViewState } from "../route-state";

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  className?: string;
  sortable?: boolean;
  value?: (row: T) => string | number;
}
export function DataTable<T>({
  data,
  columns,
  rowKey,
  caption,
  className = "",
  empty,
  groupBy,
  groupLabel,
  sortKey = "tableSort",
}: {
  data: T[];
  columns: DataColumn<T>[];
  rowKey?: (row: T, index: number) => string;
  caption?: string;
  className?: string;
  empty?: ReactNode;
  groupBy?: (row: T) => string;
  groupLabel?: (group: string) => ReactNode;
  sortKey?: string;
}) {
  const [sort, setSort] = useViewState(sortKey, "");
  const sorting = useMemo<SortingState>(
    () =>
      sort ? [{ id: sort.replace(/^-/, ""), desc: sort.startsWith("-") }] : [],
    [sort],
  );
  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: () => column.header,
        accessorFn: (row) => column.value?.(row) ?? "",
        cell: (info) => column.cell(info.row.original, info.row.index),
        enableSorting: !!column.sortable,
        sortDescFirst: false,
      })),
    [columns],
  );
  const table = useReactTable({
    autoResetPageIndex: false,
    data,
    columns: defs,
    getRowId: rowKey,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSort(next[0] ? `${next[0].desc ? "-" : ""}${next[0].id}` : "");
    },
  });
  let previous: string | undefined;
  return (
    <>
      <table className={`t ${className}`}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header, index) => (
                <th
                  key={header.id}
                  className={columns[index]?.className}
                  scope="col"
                  aria-sort={
                    header.column.getCanSort()
                      ? header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {header.column.getCanSort() ? (
                    <button
                      className="pl-table-sort"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span aria-hidden="true">
                        {header.column.getIsSorted() === "asc"
                          ? " ↑"
                          : header.column.getIsSorted() === "desc"
                            ? " ↓"
                            : " ↕"}
                      </span>
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.flatMap((row) => {
            const group = groupBy?.(row.original);
            const heading = group !== undefined && group !== previous;
            previous = group;
            return [
              heading ? (
                <tr className="pl-table-group" key={`group-${row.id}`}>
                  <th colSpan={columns.length}>
                    {groupLabel?.(group!) ?? group}
                  </th>
                </tr>
              ) : null,
              <tr key={row.id}>
                {row.getVisibleCells().map((cell, index) => (
                  <td key={cell.id} className={columns[index]?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {!data.length && empty && <div className="empty">{empty}</div>}
    </>
  );
}
