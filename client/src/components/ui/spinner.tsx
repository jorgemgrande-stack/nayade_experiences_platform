import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useI18n();
  return (
    <Loader2Icon
      role="status"
      aria-label={t("common.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
