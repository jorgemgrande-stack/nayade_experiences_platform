import { useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

export default function Gallery() {
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const categoryFilter = selectedCategory === "Todas" ? {} : { category: selectedCategory };
  const { data: items = [], isLoading } = trpc.gallery.getItems.useQuery(categoryFilter);
  const { data: categories = [] } = trpc.gallery.getCategories.useQuery();
  const allCategories = ["Todas", ...categories];

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  const prevImage = () => setLightboxIndex((i) => i !== null ? (i - 1 + items.length) % items.length : null);
  const nextImage = () => setLightboxIndex((i) => i !== null ? (i + 1) % items.length : null);

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
          {isLoading ? (
            <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className={`break-inside-avoid rounded-xl bg-muted animate-pulse ${
                    i % 3 === 0 ? "h-64" : i % 3 === 1 ? "h-48" : "h-80"
                  }`}
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <ImageOff className="w-12 h-12 mb-3 opacity-30" />
              <p className="font-medium text-lg">
                {selectedCategory === "Todas"
                  ? "La galería está vacía"
                  : `No hay fotos en "${selectedCategory}"`}
              </p>
              <p className="text-sm mt-1 opacity-70">Pronto añadiremos imágenes de nuestras experiencias.</p>
            </div>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
              {items.map((img, i) => (
                <div
                  key={img.id}
                  className="group relative break-inside-avoid rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => openLightbox(i)}
                >
                  <img
                    src={img.imageUrl}
                    alt={img.title || "Foto Náyade"}
                    className="w-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                    <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {(img.title || img.category) && (
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-gradient-to-t from-black/80 to-transparent">
                      {img.title && (
                        <p className="text-white text-sm font-medium">{img.title}</p>
                      )}
                      <p className="text-white/60 text-xs">{img.category}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Lightbox */}
      {lightboxIndex !== null && items[lightboxIndex] && (
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
              src={items[lightboxIndex].imageUrl}
              alt={items[lightboxIndex].title || "Foto Náyade"}
              className="max-w-full max-h-[80vh] object-contain rounded-xl"
            />
            <div className="text-center mt-3">
              {items[lightboxIndex].title && (
                <p className="text-white font-medium">{items[lightboxIndex].title}</p>
              )}
              <p className="text-white/50 text-sm">{lightboxIndex + 1} / {items.length}</p>
            </div>
          </div>
        </div>
      )}
    </PublicLayout>
  );
}
