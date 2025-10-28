// src/components/SearchBar.tsx
'use client';

import { FormEvent } from 'react';

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export default function SearchBar({ 
  value, 
  onChange, 
  onSubmit
}: SearchBarProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search for content in your files..."
        className="w-full px-4 py-2 text-lg text-white bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </form>
  );
}