import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange?: (items: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  className
}: Readonly<PaginationProps>) {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Generate page numbers
  const getPageNumbers = () => {
    const pages: { id: string; type: 'page' | 'ellipsis'; value?: number }[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push({ id: `page-${i}`, type: 'page', value: i });
    } else if (currentPage <= 3) {
      [1, 2, 3, 4].forEach(p => pages.push({ id: `page-${p}`, type: 'page', value: p }));
      pages.push({ id: 'ellipsis-1', type: 'ellipsis' });
      pages.push({ id: `page-${totalPages}`, type: 'page', value: totalPages });
    } else if (currentPage >= totalPages - 2) {
      pages.push({ id: `page-1`, type: 'page', value: 1 });
      pages.push({ id: 'ellipsis-1', type: 'ellipsis' });
      [totalPages - 3, totalPages - 2, totalPages - 1, totalPages].forEach(p => pages.push({ id: `page-${p}`, type: 'page', value: p }));
    } else {
      pages.push({ id: `page-1`, type: 'page', value: 1 });
      pages.push({ id: 'ellipsis-1', type: 'ellipsis' });
      [currentPage - 1, currentPage, currentPage + 1].forEach(p => pages.push({ id: `page-${p}`, type: 'page', value: p }));
      pages.push({ id: 'ellipsis-2', type: 'ellipsis' });
      pages.push({ id: `page-${totalPages}`, type: 'page', value: totalPages });
    }
    return pages;
  };

  return (
    <div className={cn("flex items-center justify-between px-2 py-3", className)}>
      <div className="text-sm text-gray-500">
        Hiển thị {startItem} đến {endItem} của {totalItems} nhân viên
      </div>
      
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 text-gray-500"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous page</span>
          </Button>
          
          {getPageNumbers().map((pageItem) => (
            pageItem.type === 'ellipsis' ? (
              <Button
                key={pageItem.id}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-500"
                disabled
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                key={pageItem.id}
                variant={currentPage === pageItem.value ? "default" : "outline"}
                size="icon"
                className={cn(
                  "h-8 w-8",
                  currentPage === pageItem.value ? "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100" : "text-gray-500"
                )}
                onClick={() => onPageChange(pageItem.value as number)}
              >
                {pageItem.value}
              </Button>
            )
          ))}

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 text-gray-500"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next page</span>
          </Button>
        </div>

        {onItemsPerPageChange && (
          <div className="ml-4">
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(v) => onItemsPerPageChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-[100px] text-sm">
                <SelectValue placeholder="10 / trang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / trang</SelectItem>
                <SelectItem value="20">20 / trang</SelectItem>
                <SelectItem value="50">50 / trang</SelectItem>
                <SelectItem value="100">100 / trang</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}
