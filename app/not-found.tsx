"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export default function NotFound() {
  const pathname = usePathname();

  useEffect(() => {
    console.error("404 Error: ไม่พบหน้าที่ต้องการเข้าถึง:", pathname);
  }, [pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">ไม่พบหน้าที่คุณต้องการ</p>
        <Link href="/" className="text-primary underline hover:text-primary/90">
          กลับสู่หน้าแรก
        </Link>
      </div>
    </div>
  );
}