import { useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { cn } from "@/lib/utils";

const galleryImages = [
  { id: 1, url: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&q=80", category: "Nieve & Ski", title: "Esquí en los Pirineos" },
  { id: 2, url: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&q=80", category: "Acuático", title: "Kayak en el Mediterráneo" },
  { id: 3, url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80", category: "Multiaventura", title: "Escalada en Roca" },
  { id: 4, url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", category: "Premium", title: "Vistas desde la Cumbre" },
  { id: 5, url: "https://images.unsplash.com/photo-1519904981063-b0cf448d479e?w=800&q=80", category: "Nieve & Ski", title: "Snowboard en Pista" },
  { id: 6, url: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80", category: "Acuático", title: "Buceo en Aguas Cristalinas" },
  { id: 7, url: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&q=80", category: "Acuático", title: "Surf en la Costa" },
  { id: 8, url: "https://images.unsplash.com/photo-1522163182402-834f871fd851?w=800&q=80", category: "Multiaventura", title: "Tirolina en el Bosque" },
  { id: 9, url: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80", category: "Multiaventura", title: "Senderismo de Montaña" },
  { id: 10, url: "https://images.unsplash.com/photo-1533130061792-64b345e4a833?w=800&q=80", category: "Premium", title: "Experiencia Exclusiva" },
  { id: 11, url: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80", category: "Nieve & Ski", title: "Paisaje Nevado" },
  { id: 12, url: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&q=80", category: "Acuático", title: "Rafting en el Río" },
];

const categories = ["Todas", "Nieve & Ski", "Acuático", "Multiaventura", "Premium"];

export default function Gallery() {
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const filtered = selectedCategory === "Todas"
    ? galleryImages
    : galleryImages.filter((img) => img.category === selectedCategory);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  const prevImage = () => setLightboxIndex((i) => i !== null ? (i - 1 + filtered.length) % filtered.length : null);
  const nextImage = () => setLightboxIndex((i) => i !== null ? (i + 1) % filtered.length : null);

  return (
    <PublicLayout>
      {/* Header */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container text-center">
          <Badge className="mb-4 bg-amber-500/20 text-amber-400 border-amber-500/30">
            Galería
          </Badge>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
            Momentos Únicos
          </h1>
          <p className="text-white/60 text-lg max-w-xl mx-auto">
            Cada imagen cuenta una historia de aventura, emoción y naturaleza. Descubre lo que te espera.
          </p>
        </div>
      </section>

      {/* Filter */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50">
        <div className="container py-4">
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  selectedCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Masonry Grid */}
      <section className="py-12">
        <div className="container">
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {filtered.map((img, i) => (
              <div
                key={img.id}
                className="group relative break-inside-avoid rounded-xl overflow-hidden cursor-pointer"
                onClick={() => openLightbox(i)}
              >
                <img
                  src={img.url}
                  alt={img.title}
                  className="w-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                  <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-white text-sm font-medium">{img.title}</p>
                  <p className="text-white/60 text-xs">{img.category}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); prevImage(); }}
            className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); nextImage(); }}
            className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div
            className="max-w-4xl max-h-[85vh] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={filtered[lightboxIndex]?.url}
              alt={filtered[lightboxIndex]?.title}
              className="max-w-full max-h-[80vh] object-contain rounded-xl"
            />
            <div className="text-center mt-3">
              <p className="text-white font-medium">{filtered[lightboxIndex]?.title}</p>
              <p className="text-white/50 text-sm">{lightboxIndex + 1} / {filtered.length}</p>
            </div>
          </div>
        </div>
      )}
    </PublicLayout>
  );
}
