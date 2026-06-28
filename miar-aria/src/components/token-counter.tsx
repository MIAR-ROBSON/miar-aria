import { Heart } from "lucide-react";
import { useGetTokenUsage, getGetTokenUsageQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";

export function TokenCounter() {
  const { data: usage } = useGetTokenUsage({
    query: { queryKey: getGetTokenUsageQueryKey(), refetchInterval: 30000 }
  });

  const percent = usage?.overall ?? 0;

  let colorClass = "text-emerald-500";
  let fillClass = "fill-emerald-500";
  let pulseClass = "";

  if (percent <= 50 && percent > 20) {
    colorClass = "text-amber-500";
    fillClass = "fill-amber-500";
  } else if (percent <= 20 && percent > 10) {
    colorClass = "text-red-500";
    fillClass = "fill-red-500";
  } else if (percent <= 10 && percent > 0) {
    colorClass = "text-red-600";
    fillClass = "fill-red-600";
    pulseClass = "animate-pulse";
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${pulseClass}`} title="Uso de tokens">
          <Heart className={`w-5 h-5 ${fillClass} ${colorClass}`} />
          <span className={`font-bold text-sm tabular-nums ${colorClass}`}>{Math.round(percent)}%</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="center">
        <h4 className="font-semibold mb-1 text-sm">Tokens Disponíveis</h4>
        <p className="text-xs text-muted-foreground mb-4">Estimativa diária por provedor</p>
        <div className="space-y-4">
          {usage?.providers.map((p) => (
            <div key={p.provider} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="capitalize font-medium">{p.provider}</span>
                <span className={p.percentRemaining > 50 ? "text-emerald-500" : p.percentRemaining > 20 ? "text-amber-500" : "text-red-500"}>
                  {Math.round(p.percentRemaining)}% restante
                </span>
              </div>
              <Progress value={p.percentRemaining} className="h-2" />
            </div>
          ))}
          {(!usage?.providers?.length) && (
            <p className="text-xs text-muted-foreground text-center py-2">Nenhuma chave configurada</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
