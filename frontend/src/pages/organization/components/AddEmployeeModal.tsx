import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useLanguage } from "@/contexts/LanguageContext"

interface AddEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddEmployeeModal({ isOpen, onClose }: AddEmployeeModalProps) {
  const { t } = useLanguage();

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title={t('addNewEmployee')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button className="bg-blue-600 hover:bg-blue-700">{t('saveEmployee')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('fullNameLabel')}</label>
            <Input placeholder={t('fullNamePlaceholder')} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('empCodeLabel')}</label>
            <Input placeholder="HL0000" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">{t('emailLabel')}</label>
          <Input type="email" placeholder="email@hoanglong.com" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('departmentLabel')}</label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder={t('selectDepartment')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="it">IT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('titleLabel')}</label>
            <Input placeholder={t('titlePlaceholder')} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
