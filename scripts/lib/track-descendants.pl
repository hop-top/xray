#!/usr/bin/perl
# Record every descendant (and process-group member) of <root_pid> seen while it
# runs, as "pid|lstart" lines appended to <outfile>. Polls `ps`; runs until
# killed. Needed because orphans re-parent to launchd/init and lose their
# ancestry, and platform binaries (sleep, sh) hide their environment from
# `ps -E`, so the env tag alone cannot find them.
use strict; use warnings;
my ($root, $out, $interval) = @ARGV;
$interval ||= 0.3;
my %seen;
$| = 1;
while (1) {
  my (%kids, %start, %pgid);
  for (`ps -axo pid=,ppid=,pgid=,lstart= 2>/dev/null`) {
    next unless /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/;
    my ($p, $pp, $pg, $ls) = ($1, $2, $3, $4);
    $start{$p} = $ls; $pgid{$p} = $pg;
    push @{ $kids{$pp} }, $p;
  }
  my @queue = ($root); my %in;
  while (defined(my $p = shift @queue)) {
    next if $in{$p}++;
    push @queue, @{ $kids{$p} || [] };
  }
  for my $p (keys %start) { $in{$p} = 1 if $pgid{$p} == $root; }
  for my $p (keys %in) {
    next unless exists $start{$p};
    my $k = "$p|$start{$p}";
    next if $seen{$k}++;
    if (open(my $fh, '>>', $out)) { print $fh "$k\n"; close $fh; }
  }
  select(undef, undef, undef, $interval);
}
