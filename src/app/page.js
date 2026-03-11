"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useState } from "react";

export default function Home() {
  const [date, setDate] = useState(new Date());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 dark:bg-black p-8">

      {/* Input */}
      <div className="w-full max-w-sm flex flex-col gap-1.5">
        <Label htmlFor="demo">Label</Label>
        <Input id="demo" placeholder="Input placeholder..." />
      </div>
      
    </div>
  );
}
