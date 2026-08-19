import { useState } from "react"
import { Search, Filter, Plus, Eye, Edit2, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Pagination } from "@/components/ui/pagination"
import { AddEmployeeModal } from "./components/AddEmployeeModal"
import { useLanguage } from "@/contexts/LanguageContext"

// Mock Data
const MOCK_EMPLOYEES = [
  { id: 1, name: "Nguyễn Văn An", email: "nv.an@hoanglong.com", code: "HL0001", department: "Ban Giám đốc", title: "Tổng giám đốc", phone: "0901 234 567", status: "statusActive" },
  { id: 2, name: "Trần Thị Bình", email: "tt.binh@hoanglong.com", code: "HL0002", department: "Phòng Kinh doanh", title: "Trưởng phòng", phone: "0902 345 678", status: "statusActive" },
  { id: 3, name: "Lê Hoàng Nam", email: "lh.nam@hoanglong.com", code: "HL0003", department: "Phòng IT", title: "Lập trình viên", phone: "0903 456 789", status: "statusActive" },
  { id: 4, name: "Phạm Thị Lan", email: "pt.lan@hoanglong.com", code: "HL0004", department: "Phòng Kế toán", title: "Kế toán trưởng", phone: "0904 567 890", status: "statusPause" },
  { id: 5, name: "Hoàng Minh Đức", email: "hm.duc@hoanglong.com", code: "HL0005", department: "Phòng Vận hành", title: "Nhân viên vận hành", phone: "0905 678 901", status: "statusActive" },
  { id: 6, name: "Đặng Thùy Dương", email: "dt.duong@hoanglong.com", code: "HL0006", department: "Phòng Nhân sự", title: "Chuyên viên nhân sự", phone: "0906 789 012", status: "statusInactive" },
  { id: 7, name: "Bùi Quốc Khánh", email: "bq.khanh@hoanglong.com", code: "HL0007", department: "Phòng Kinh doanh", title: "Nhân viên kinh doanh", phone: "0907 890 123", status: "statusActive" },
];

export default function EmployeeManagementPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { t } = useLanguage();

  const getStatusBadge = (statusKey: string) => {
    // We map the mock data statusKey to translation key.
    const statusText = t(statusKey as any);
    switch (statusKey) {
      case "statusActive":
        return <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">{statusText}</span>;
      case "statusPause":
        return <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">{statusText}</span>;
      case "statusInactive":
        return <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10">{statusText}</span>;
      default:
        return <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">{statusText}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{t('employeeList')}</h1>
        <Button onClick={() => setIsAddModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="h-4 w-4" />
          {t('addEmployee')}
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center bg-gray-50/50">
          <div className="relative w-full sm:w-64 flex-shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="pl-9 h-9 w-full bg-white border-gray-200"
            />
          </div>
          
          <Select defaultValue="all-branch">
            <SelectTrigger className="w-full sm:w-[160px] h-9 bg-white border-gray-200">
              <SelectValue placeholder={t('branchAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-branch">{t('branchAll')}</SelectItem>
              <SelectItem value="hn">{t('branchHn')}</SelectItem>
              <SelectItem value="hcm">{t('branchHcm')}</SelectItem>
            </SelectContent>
          </Select>

          <Select defaultValue="all-dept">
            <SelectTrigger className="w-full sm:w-[160px] h-9 bg-white border-gray-200">
              <SelectValue placeholder={t('departmentAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-dept">{t('departmentAll')}</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="it">IT</SelectItem>
            </SelectContent>
          </Select>

          <Select defaultValue="all-status">
            <SelectTrigger className="w-full sm:w-[150px] h-9 bg-white border-gray-200">
              <SelectValue placeholder={t('statusAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-status">{t('statusAll')}</SelectItem>
              <SelectItem value="active">{t('statusActive')}</SelectItem>
              <SelectItem value="inactive">{t('statusInactive')}</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" className="h-9 gap-2 border-gray-200 bg-white ml-auto">
            <Filter className="h-4 w-4" />
            {t('filterBtn')}
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="w-[50px] text-center font-semibold text-gray-600">{t('colIndex')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colEmployee')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colEmpCode')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDepartment')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colTitle')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colEmail')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colPhone')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="text-right font-semibold text-gray-600 pr-6">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_EMPLOYEES.map((employee, index) => (
                <TableRow key={employee.id} className="hover:bg-blue-50/30 transition-colors">
                  <TableCell className="text-center text-gray-500 font-medium">
                    {(currentPage - 1) * itemsPerPage + index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 ring-1 ring-gray-100">
                        <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                          {employee.name.split(' ').pop()?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{employee.name}</span>
                        <span className="text-xs text-gray-500">{employee.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600">{employee.code}</TableCell>
                  <TableCell className="text-gray-600">{employee.department}</TableCell>
                  <TableCell className="text-gray-600">{employee.title}</TableCell>
                  <TableCell className="text-gray-600">{employee.email}</TableCell>
                  <TableCell className="text-gray-600">{employee.phone}</TableCell>
                  <TableCell>{getStatusBadge(employee.status)}</TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-600">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Pagination 
          currentPage={currentPage}
          totalPages={26}
          totalItems={256}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={setItemsPerPage}
          className="border-t border-gray-100 bg-gray-50/30"
        />
      </div>

      <AddEmployeeModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
      />
    </div>
  )
}
