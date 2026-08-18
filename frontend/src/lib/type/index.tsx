import type { PaginationInfo } from "@/interface/members";
import { BookAlert, Columns3Cog } from "lucide-react";
import type { ReactNode } from "react";

interface SidebarItem {
  title: string;
  url: string;
}

interface SidebarMainGroup {
  icon: ReactNode;
  iconHover?: ReactNode;
  title?: string;
  items?: SidebarItem[];
}

export interface SidebarContent {
  navMain: SidebarMainGroup[];
}
export const sidebarContent = {
  navMain: [
    // {
    //   icon: <BookAlert className="w-4 h-4" />,
    //   items: [
    //     {
    //       title: "Dashboard",
    //       url: "/dashboard",
    //     },
    //   ],
    // },
    // {
    //   icon: <BookAlert className="w-4 h-4" />,
    //   items: [
    //     {
    //       title: "Agent Management",
    //       url: "/agent",
    //     },
    //   ],
    // },

    {
      icon: <BookAlert className="w-4 h-4" />,
      items: [
        {
          title: "Member Management",
          url: "/member",
        },
      ],
    },
    {
      icon: <BookAlert className="w-4 h-4" />,
      items: [
        {
          title: "Post Management",
          url: "/post",
        },
      ],
    },
    {
      icon: <BookAlert className="w-4 h-4" />,
      title: "Coupons Management",
      items: [
        {
          title: "Brands & Categories",
          url: "/coupons/category",
        },
        {
          title: "Coupon List",
          url: "/coupons",
        },
      ],
    },
    {
      icon: <Columns3Cog className="w-4 h-4" />,
      title: "Configuration",
      items: [
        {
          title: "Game Lists",
          url: "/config/game",
        },
        {
          title: "Game Types",
          url: "/config/game-type",
        },
        {
          title: "Game Providers",
          url: "/config/game-provider",
        },
        {
          title: "Rewards",
          url: "/config/reward",
        },
      ],
    },
  ] as SidebarMainGroup[],
};

export interface TableCellProps<T> {
  key: string;
  title: ReactNode;
  sort?: boolean;
  width?: number | string;
  /** Cell + header text alignment (default matches table: centered). */
  align?: "left" | "center";
  render?: (data: T) => ReactNode;
  children?: TableCellProps<T>[];
}

export interface TableProps<T> {
  onSelectRow?: (data: T) => void;
  table: TableCellProps<T>[];
  className?: string;
  classNameTable?: string;
  isLoading: boolean;
  data: T[];
  /** When set, shown instead of "Not Found" for an empty table (e.g. successful API with zero rows). */
  emptyMessage?: string;
  pagination?: PaginationInfo;
  onChangePage?: (page: number) => void;
  onChangeLimit?: (limit: number) => void;
  onSort?: (sort: SortState) => void;
  onRowClick?: (data: T) => void;
  rowDragEnabled?: boolean;
  getRowDragId?: (data: T) => string;
  onRowDragMove?: (dragId: string, hoverId: string) => void;
}

export interface FilterPaginationProps {
  pagination?: PaginationInfo;
  onChangePage?: (page: number) => void;
  onChangeLimit?: (limit: number) => void;
}

export type SortDirection = "asc" | "desc" | undefined;
export interface SortState {
  key?: string;
  direction?: SortDirection;
}
